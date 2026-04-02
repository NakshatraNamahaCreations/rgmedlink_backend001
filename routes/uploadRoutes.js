const router = require("express").Router();
const multer = require("multer");
const path = require("path");

const uploadController = require("../controllers/uploadPrescriptionController");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({ storage });

// PDF prescription upload
router.post(
  "/upload-prescription",
  upload.single("file"),
  uploadController.processPDFPrescription
);

// Image prescription upload (camera/gallery)
router.post(
  "/upload-image",
  upload.single("file"),
  uploadController.processImagePrescription
);

module.exports = router;
