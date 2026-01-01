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

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Missing file: photo" });
    }

    const name = (req.body.name || "").trim();
    const visibility = (req.body.visibility || "private").trim(); // ✅ NEW

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
          visibility, // ✅ stored as custom metadata on the object
        },
      },
    });

    stream.on("error", (err) => {
      console.error(err);
      res.status(500).json({ error: err.message });
    });

    stream.on("finish", async () => {
      return res.json({
        ok: true,
        bucket: BUCKET_NAME,
        objectName,
        visibility,
      });
    });

    stream.end(req.file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
