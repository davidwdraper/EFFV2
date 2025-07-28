import { Request, Response } from 'express';
import axios from 'axios';


export const proxyRequest = async (req: Request, res: Response, target: string) => {
  //const url = `${target}${req.originalUrl}`; // ✅ assemble full target URL
  //const url = `${target}${req.originalUrl.replace(/^\/api\/users/, '')}`;
  console.log(`[PROXY] → ${target}`);            // ✅ log it for debugging

  try {
    const response = await fetch(target, {
  method: req.method,
  headers: {
    'Content-Type': 'application/json',
    Authorization: req.headers.authorization || '',
  },
  body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : JSON.stringify(req.body),
});


    const data = await response.text();
    res.status(response.status).send(data);
  } catch (err) {
    console.error('[PROXY ERROR]', err);
    res.status(500).send({ error: 'Proxy request failed.' });
  }
};
