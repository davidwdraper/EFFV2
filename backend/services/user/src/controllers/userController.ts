import { Request, Response } from 'express';
import { UserModel } from '../models/User';
import { IUser } from '../models/IUser';

export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      eMailAddr,
      password,
      firstname,
      lastname,
      middlename,
      userType = 1,
    } = req.body;

    // 🔍 Check if email already exists
    const existing = await UserModel.findOne({ eMailAddr });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const now = new Date();

    // 📦 Build user data
    const userData: Partial<IUser> = {
      eMailAddr,
      password,
      firstname,
      lastname,
      middlename,
      userType,
      userStatus: 0,
      dateCreated: now,
      dateLastUpdated: now,
      imageIds: [],
    };

    // 🧾 Save user (hashing + ID assignment handled by schema)
    const user = new UserModel(userData);
    await user.save();

    return res.status(201).json({ id: user._id });
  } catch (err: any) {
    console.error('[UserService] createUser error:', err);
    return res.status(500).json({ error: 'Failed to create user' });
  }
};

export const getUserByEmail = async (req: Request, res: Response) => {
  try {
    const user = await UserModel.findOne({ eMailAddr: req.params.eMailAddr }).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err: any) {
    console.error('[UserService] getUserByEmail error:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve user' });
  }
};

