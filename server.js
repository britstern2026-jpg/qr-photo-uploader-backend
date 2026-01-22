import express from "express";
import multer from "multer";
import cors from "cors";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import fs from "fs";

const ADMIN_PASSWORD = "1234";

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// ✅ Your bucket name
const BUCKET_NAME = "brit-qr-uploads-482609";

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// ==========================
// ✅ Health check
// ==========================
app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use POST /upload to upload photos.");
});

// ==========================
// ✅ Upload endpoint (ORIGINAL + THUMB)
// ==========================
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const name = (req.body.name || "photo").trim() || "photo";
    const visibility = (req.body.visibility || "private").trim();

    const ext = req.file.originalname.split(".").pop() || "jpg";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const originalName = `${name}_${timestamp}.${ext}`;
    const thumbName = `thumbs/${name}_${timestamp}.jpg`;

    // ✅ Create thumbnail locally
    const thumbPath = `${req.file.path}_thumb.jpg`;

    await sharp(req.file.path)
      .rotate()
      .resize({ width: 600 })   // ✅ thumbnail width (fast enough + good quality)
      .jpeg({ quality: 70 })    // ✅ smaller file
      .toFile(thumbPath);

    // ✅ Upload original
    await bucket.upload(req.file.path, {
      destination: originalName,
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          visibility,
          thumb: thumbName
        }
      }
    });

    // ✅ Upload thumbnail
    await bucket.upload(thumbPath, {
      destination: thumbName,
      metadata: {
        contentType: "image/jpeg",
        metadata: {
          visibility,
          isThumb: "true"
        }
      }
    });

    // cleanup temp files
    fs.unlink(req.file.path, () => {});
    fs.unlink(thumbPath, () => {});

    res.json({
      ok: true,
      bucket: BUCKET_NAME,
      objectName: originalName,
      thumbObject: thumbName,
      visibility
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ Photos endpoint (returns thumb + full)
// ==========================
app.get("/photos", async (req, res) => {
  try {
    const requestPassword = (req.header("x-gallery-password") || "").trim();
    const isAdmin = requestPassword === ADMIN_PASSWORD;

    const [files] = await bucket.getFiles({});

    // newest first
    files.sort((a, b) => (b.metadata.updated || "").localeCompare(a.metadata.updated || ""));

    // ✅ remove thumbnails from list (we link them via metadata)
    const originals = files.filter(f => !f.name.startsWith("thumbs/"));

    const publicFiles = originals.filter((file) => {
      const v = file.metadata?.metadata?.visibility || "private";
      return v === "public";
    });

    const visibleFiles = isAdmin ? originals : publicFiles;

    const photos = await Promise.all(
      visibleFiles.map(async (file) => {
        const thumbPath = file.metadata?.metadata?.thumb;

        const [signedUrl] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000
        });

        let signedThumbUrl = signedUrl; // fallback = full image
        if (thumbPath) {
          const thumbFile = bucket.file(thumbPath);
          const [thumbSigned] = await thumbFile.getSignedUrl({
            version: "v4",
            action: "read",
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000
          });
          signedThumbUrl = thumbSigned;
        }

        return {
          name: file.name,
          signedUrl,
          signedThumbUrl,
          visibility: file.metadata?.metadata?.visibility || "private",
          updated: file.metadata.updated,
          size: file.metadata.size,
          contentType: file.metadata.contentType
        };
      })
    );

    res.json({ ok: true, admin: isAdmin, photos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ Start server
// ==========================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
