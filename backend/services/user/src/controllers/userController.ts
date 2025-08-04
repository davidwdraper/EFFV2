import { Request, Response } from "express";
import { UserModel } from "../models/User";
import { logger } from "@shared/utils/logger";

// 🔍 GET user by email — used by authService during login
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

    res.json(user);
  } catch (err: any) {
    logger.error("userService: getUserByEmail failed", {
      eMailAddr,
      error: err.message || "Unknown error",
    });
    return res.status(500).json({ error: "Failed to retrieve user" });
  }
};
