import { Request, Response } from 'express';
import { UserModel } from '../models/User';
import { IUser } from '../models/IUser';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';

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

    const currentEnv = process.env.NODE_ENV || 'dev';
    //const envPath = path.resolve(process.cwd(), `.env.${currentEnv}`);
    const envPath = path.resolve(__dirname, '../../../../../.env.' + currentEnv);
    dotenv.config({ path: envPath });

    console.log(`[User env] Loaded environment: ${currentEnv} from ${envPath}`);

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

    // 🔐 Create JWT
    const JWT_SECRET = process.env.JWT_SECRET || '2468';
    console.log("[jwt.sign] JWT_SECRET: ", JWT_SECRET);

    const token = jwt.sign(
      {
        _id: user._id.toString(),
        firstname: user.firstname,
        lastname: user.lastname,
        eMailAddr: user.eMailAddr,
        userType: user.userType,
      },
      JWT_SECRET,
      { expiresIn: '100h' }
    );

    // ✅ Return user + token
    return res.status(201).json({
      user: {
        _id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        middlename: user.middlename,
        eMailAddr: user.eMailAddr,
        userType: user.userType,
      },
      token,
    });
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

