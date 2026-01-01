import express from "express";
import multer from "multer";
import cors from "cors";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// ✅ Your bucket name
const BUCKET_NAME = "brit-qr-uploads-482609";

// ✅ Cloud Run automatically provides credentials if service account attached
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// ==========================
// ✅ Health check
// ==========================
app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use POST /upload to upload photos.");
});

// ==========================
// ✅ Upload endpoint
// ==========================
app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const name = (req.body.name || "photo").trim() || "photo";
    const ext = req.file.originalname.split(".").pop() || "jpg";
    const filename = `${name}_${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;

    await bucket.upload(req.file.path, {
      destination: filename,
      metadata: {
        contentType: req.file.mimetype
      }
    });

    res.json({
      ok: true,
      bucket: BUCKET_NAME,
      objectName: filename
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ Gallery endpoint (SIGNED URLS)
// ==========================
app.get("/photos", async (req, res) => {
  try {
    const [files] = await bucket.getFiles({
      // optional: prefix: "everyone/" etc if you ever add folders
    });

    // newest first
    files.sort((a, b) => (b.metadata.updated || "").localeCompare(a.metadata.updated || ""));

    const photos = await Promise.all(
      files.map(async (file) => {
        // Create signed URL valid for 7 days
        const [signedUrl] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000
        });

        return {
          name: file.name,
          signedUrl,
          updated: file.metadata.updated,
          size: file.metadata.size,
          contentType: file.metadata.contentType
        };
      })
    );

    res.json({ ok: true, photos });
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
