/// <reference path="../types/express/index.d.ts" />

import express from 'express';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import UserModel from '../models/User';
import { dateNow } from '../misc/utils/dateUtils';
import { newId } from '../misc/utils/idUtils';
import { sendError, sendSuccess } from '../misc/utils/response';

// Define the expected shape of req.body
interface CreateUserBody {
  userType: number;
  firstname: string;
  lastname: string;
  middlename?: string;
  eMailAddr: string;
  imageIds?: string[];
}

export const createUser = async (
  req: express.Request<unknown, unknown, CreateUserBody>,
  res: Response
) => {
  try {
    const creatorId = req.user?.userId;

    console.log("req.user: ", req.user);
    console.log("req.body: ", req.body);

    if (!creatorId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      userType,
      firstname,
      lastname,
      middlename,
      eMailAddr,
      imageIds,
    } = req.body;

    const createdAt = dateNow();

    const userData = {
      dateCreated: createdAt,
      dateLastUpdated: createdAt,
      userStatus: 0,
      userType,
      userEntryId: creatorId,
      userOwnerId: creatorId,
      firstname,
      lastname,
      middlename,
      eMailAddr,
      imageIds: Array.isArray(imageIds) ? imageIds.slice(0, 10) : [],
    };

    const user = new UserModel(userData);
    await user.save();

    return sendSuccess(res, user);
  } catch (err: any) {
    console.error('User creation failed:', err.message);
    return sendError(res, err.message)
  }
};
