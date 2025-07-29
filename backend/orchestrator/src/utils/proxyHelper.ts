import axios, { AxiosRequestHeaders } from 'axios';
import { Request, Response } from 'express';

export const proxyRequest = async (
  req: Request,
  res: Response,
  serviceBaseUrl: string
) => {
  const method = req.method.toUpperCase();

  // 🪓 Strip the mount path (/Users) from the URL
  const forwardedPath = req.originalUrl.replace(/^\/Users/, '') || '/';
  const targetUrl = `${serviceBaseUrl}${forwardedPath}`;

  console.log(`[proxy] ${method} → ${targetUrl}`);

  try {
    const axiosOptions: any = {
      method,
      url: targetUrl,
      headers: {
        ...(req.headers as AxiosRequestHeaders),
        host: undefined,
      },
      params: req.query,
      timeout: 5000,
    };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      axiosOptions.data = req.body;
    }

    const response = await axios(axiosOptions);
    res.status(response.status).send(response.data);
  } catch (err: any) {
    const status = err.response?.status || 500;
    const message =
      err.response?.data?.error ||
      err.response?.data ||
      err.message ||
      'Unknown proxy error';

    console.error(`[proxy error] ${method} ${targetUrl} → ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
};
