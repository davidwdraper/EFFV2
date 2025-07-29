// src/controllers/authController.ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import bcrypt from 'bcrypt';
import { config } from '../config';

export const signup = async (req: Request, res: Response) => {
  try {
    const response = await axios.post(`${config.orchestratorUrl}/Users`, req.body);
    res.status(response.status).json(response.data);
  } catch (err: any) {
    console.error('[AuthService] Signup error via orchestrator:', err.message);
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || 'Signup failed';
    res.status(status).json({ error: message });
  }
};

export const login = async (req: Request, res: Response) => {
  const { eMailAddr, password } = req.body;

  try {
    const response = await axios.get(`${config.orchestratorUrl}/Users/byEmail/${eMailAddr}`);
    const user = response.data;

    if (!user?.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      {
        eMailAddr: user.eMailAddr,
        userType: user.userType,
      },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({ token });
  } catch (err: any) {
    console.error('[AuthService] Login error:', err.message);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
};
