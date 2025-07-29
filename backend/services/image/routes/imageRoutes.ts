import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { uploadImage, deleteImage } from '../controllers/imageController';

const router = express.Router();

// Multer instance with 10MB limit
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

// Handle multer errors with a middleware wrapper
const safeUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image must be under 10MB' });
    } else if (err) {
      return res.status(500).json({ error: 'Unexpected upload error' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }
    next();
  });
};

// POST /images — upload
router.post('/', safeUpload, uploadImage);

// DELETE /images/:id
router.delete('/:id', deleteImage);

export default router;
