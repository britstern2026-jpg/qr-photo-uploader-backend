import express from "express";
import multer from "multer";
import cors from "cors";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

const BUCKET_NAME = process.env.BUCKET_NAME || "brit-qr-uploads-482609";

// ✅ Cloud Run uses its attached service account automatically
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use POST /upload to upload photos.");
});

/**
 * ✅ Upload endpoint
 * Always uploads the file.
 * If visibility === "public", it will make the uploaded object publicly readable.
 */
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Missing file: photo" });
    }

    const name = (req.body.name || "").trim();
    const visibility = (req.body.visibility || "private").trim(); // public | private

    const safeBase = name ? name.replace(/[^\w\-]+/g, "_") : "photo";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = req.file.originalname?.split(".").pop() || "jpg";
    const objectName = `${safeBase}_${timestamp}.${ext}`;

    const file = bucket.file(objectName);

    const stream = file.createWriteStream({
      resumable: false,
      contentType: req.file.mimetype,
      metadata: {
        metadata: {
          visibility, // ✅ stored as custom metadata
        },
      },
    });

    stream.on("error", (err) => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });

    stream.on("finish", async () => {
      try {
        // ✅ If public, make it readable by anyone (for gallery)
        if (visibility === "public") {
          await file.makePublic();
        }

        return res.json({
          ok: true,
          bucket: BUCKET_NAME,
          objectName,
          visibility,
        });
      } catch (err) {
        console.error("Finish error:", err);
        return res.status(500).json({ error: err.message });
      }
    });

    stream.end(req.file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * ✅ Gallery endpoint
 * Returns ONLY files marked visibility=public.
 * Uses public URLs (no signed URLs).
 */
app.get("/photos", async (req, res) => {
  try {
    const [files] = await bucket.getFiles({ autoPaginate: true });

    const results = [];

    for (const f of files) {
      try {
        const [meta] = await f.getMetadata();
        const visibility = meta?.metadata?.visibility || "private";

        if (visibility !== "public") continue;

        results.push({
          name: f.name,
          url: `https://storage.googleapis.com/${BUCKET_NAME}/${encodeURIComponent(
            f.name
          )}`,
          updated: meta.updated || null,
          size: meta.size || null,
          contentType: meta.contentType || null,
        });
      } catch (e) {
        // skip bad files
        continue;
      }
    }

    // ✅ newest first (if updated exists)
    results.sort((a, b) => {
      const da = a.updated ? new Date(a.updated).getTime() : 0;
      const db = b.updated ? new Date(b.updated).getTime() : 0;
      return db - da;
    });

    res.json({ ok: true, photos: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
