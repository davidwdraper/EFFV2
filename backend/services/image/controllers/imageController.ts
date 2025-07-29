import { Request, Response } from 'express';
import { ImageModel } from '../models/Image';

export const uploadImage = async (req: Request, res: Response) => {
  try {
    const { notes, createdBy } = req.body;

    if (!req.file || !createdBy) {
      return res.status(400).json({ error: 'Missing image or createdBy' });
    }

    const imageDoc = new ImageModel({
      image: req.file.buffer,
      notes,
      createdBy,
    });

    await imageDoc.save();
    return res.status(201).json({ id: imageDoc._id });
  } catch (err) {
    console.error('[ImageService] upload error:', err);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
};

export const deleteImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await ImageModel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[ImageService] delete error:', err);
    return res.status(500).json({ error: 'Failed to delete image' });
  }
};
