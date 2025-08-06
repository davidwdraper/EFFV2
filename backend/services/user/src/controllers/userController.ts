import { Request, Response } from "express";
import { UserModel } from "../models/User";
import { logger } from "@shared/utils/logger";

// 🔐 Helper: Return only safe user fields (no password)
const getSafeUser = (user: any) => ({
  _id: user._id,
  eMailAddr: user.eMailAddr,
  firstname: user.firstname,
  middlename: user.middlename,
  lastname: user.lastname,
});

// 🔍 GET user by email — used by authService during login
export const getUserByEmailWithPassword = async (
  req: Request,
  res: Response
) => {
  const eMailAddr = req.params.eMailAddr;

  logger.debug(
    `userService: getUserByEmailWithPassword called. eMailAddr: ${eMailAddr}`,
    {}
  );

  try {
    const user = await UserModel.findOne({ eMailAddr });

    if (!user) {
      logger.debug("userService: User not found", { eMailAddr });
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      _id: user._id,
      eMailAddr: user.eMailAddr,
      password: user.password, // ⚠️ safe only internally
    });
  } catch (err: any) {
    logger.error("getUserByEmailWithPassword failed", {
      eMailAddr,
      error: err.message || "Unknown error",
    });
    return res.status(500).json({ error: "Failed to retrieve user" });
  }
};

// 🔍 GET user by email
export const getUserByEmail = async (req: Request, res: Response) => {
  const eMailAddr = req.params.eMailAddr;

  logger.debug(
    `userService: getUserByEmail called. eMailAddr: ${eMailAddr}`,
    {}
  );

  try {
    const user = await UserModel.findOne({ eMailAddr });

    if (!user) {
      logger.debug("userService: User not found", { eMailAddr });
      return res.status(404).json({ error: "User not found" });
    }

    res.json(getSafeUser(user));
  } catch (err: any) {
    logger.error("userService: getUserByEmail failed", {
      eMailAddr,
      error: err.message || "Unknown error",
    });
    return res.status(500).json({ error: "Failed to retrieve user" });
  }
};
