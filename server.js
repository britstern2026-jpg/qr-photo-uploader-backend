import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(cors());

// Multer stores uploaded files temporarily in ./uploads
const upload = multer({ dest: "uploads/" });

// ===== CONFIG =====
const BUCKET_NAME = "brit-qr-uploads-482609";
// ==================

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use POST /upload to upload photos.");
});

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || "").trim();

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Build a nice filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Keep original extension if possible (png/jpg/etc)
    const ext = path.extname(file.originalname) || ".jpg";
    const finalName = `${name ? name + "_" : ""}${timestamp}${ext}`;

    // Upload to bucket
    await bucket.upload(file.path, {
      destination: finalName,
      metadata: {
        contentType: file.mimetype,
      },
    });

    // Delete temp file
    fs.unlinkSync(file.path);

    res.json({
      ok: true,
      bucket: BUCKET_NAME,
      objectName: finalName,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Cloud Run uses PORT env var; locally it'll be 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("✅ Server running on port", PORT));
