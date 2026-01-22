import express from "express";
import multer from "multer";
import cors from "cors";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

const BUCKET_NAME = process.env.BUCKET_NAME || "brit-qr-uploads-482609";
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use POST /upload to upload photos.");
});

function safeBaseName(name) {
  const n = (name || "").trim();
  return n ? n.replace(/[^\w\-]+/g, "_") : "photo";
}

function getExtFromMime(mime) {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

async function uploadBufferToGCS({ objectName, buffer, contentType, visibility }) {
  const file = bucket.file(objectName);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        visibility: visibility || "private",
      },
    },
  });
}

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file: photo" });

    const name = (req.body.name || "").trim();
    const visibility = (req.body.visibility || "private").trim(); // "public" | "private"

    const safeBase = safeBaseName(name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Store original under a stable name
    const origExt = req.file.originalname?.split(".").pop() || getExtFromMime(req.file.mimetype);
    const objectName = `${safeBase}_${timestamp}.${origExt}`;

    // Thumbnail object name
    const thumbObjectName = `thumbs/${safeBase}_${timestamp}.jpg`;

    // 1) Upload original (unchanged)
    await uploadBufferToGCS({
      objectName,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      visibility,
    });

    // 2) Create thumbnail (auto-rotate by EXIF + shrink)
    //    rotate() with no args = respect EXIF orientation and bake it into pixels
    const thumbBuffer = await sharp(req.file.buffer)
      .rotate()
      .resize({
        width: 420,          // good for grid, fast
        withoutEnlargement: true,
      })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    await uploadBufferToGCS({
      objectName: thumbObjectName,
      buffer: thumbBuffer,
      contentType: "image/jpeg",
      visibility, // keep same visibility as original
    });

    res.json({
      ok: true,
      bucket: BUCKET_NAME,
      objectName,
      thumbObjectName,
      visibility,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/photos", async (req, res) => {
  try {
    const [files] = await bucket.getFiles({});

    // Only originals (exclude thumbs/)
    const originals = files.filter((f) => !f.name.startsWith("thumbs/"));

    // newest first
    originals.sort((a, b) => (b.metadata.updated || "").localeCompare(a.metadata.updated || ""));

    // ONLY public images (your current behavior)
    const publicOriginals = originals.filter((file) => {
      const v = file.metadata?.metadata?.visibility || "private";
      return v === "public";
    });

    const photos = await Promise.all(
      publicOriginals.map(async (file) => {
        const base = file.name.replace(/\.[^.]+$/, ""); // remove extension
        const thumbName = `thumbs/${base}.jpg`;
        const thumbFile = bucket.file(thumbName);

        const [signedUrl] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        // thumb might not exist for older uploads -> fallback to full
        let thumbSignedUrl = signedUrl;
        try {
          const [exists] = await thumbFile.exists();
          if (exists) {
            const [turl] = await thumbFile.getSignedUrl({
              version: "v4",
              action: "read",
              expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
            });
            thumbSignedUrl = turl;
          }
        } catch (_) {
          // ignore, fallback to full
        }

        return {
          name: file.name,
          signedUrl,         // full image
          thumbSignedUrl,    // thumbnail image
          visibility: file.metadata?.metadata?.visibility || "private",
          updated: file.metadata.updated,
          size: file.metadata.size,
          contentType: file.metadata.contentType,
        };
      })
    );

    res.json({ ok: true, photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
