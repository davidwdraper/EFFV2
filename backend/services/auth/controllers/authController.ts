import jwt from 'jsonwebtoken';
import User from '../models/User';
import { Request, Response } from 'express';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = jwt.sign({ i_d: user._id }, process.env.JWT_SECRET!, { expiresIn: '1d' });
  res.json({ token });
};

export const signup = async (req: Request, res: Response) => {
  const user = await User.create(req.body);
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET!, { expiresIn: '1d' });
  res.status(201).json({ token });
};