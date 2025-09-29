// backend/services/image/src/middleware/upload.ts
import multer from "multer";

/**
 * Multer in-memory upload middleware.
 * Keep routes one-liners; keep controllers logic-only.
 * Add size/type limits here later if needed.
 */
const storage = multer.memoryStorage();
// Example to enforce images only (uncomment later):
// const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
//   if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image/* allowed"));
//   cb(null, true);
// };
// export const uploadMiddleware = multer({ storage, fileFilter });

export const uploadMiddleware = multer({ storage });
