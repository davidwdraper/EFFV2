import axios from 'axios';
import { Request, Response } from 'express';

/**
 * Proxies an incoming request to a target service URL.
 * Forwards method, headers (selectively), and body if applicable.
 */
export async function proxyRequest(req: Request, res: Response, serviceUrl: string) {
  try {
    const targetUrl = `${serviceUrl}${req.originalUrl}`;
    const method = req.method.toLowerCase();

    console.log(`[orchestrator] [proxy] ${req.method} → ${targetUrl}`);
    if (['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      console.log('[proxy] body:', req.body);
    }

    // ✅ Forward only safe headers
    const { authorization, cookie } = req.headers;
    const headers: Record<string, any> = {
      authorization,
      cookie,
      'Content-Type': 'application/json',
    };

    // ✅ Build axios request
    const response = await axios({
      method,
      url: targetUrl,
      headers,
      data: ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())
        ? req.body
        : undefined,
      timeout: 5000,
    });

    // ✅ Forward response back to caller
    res.status(response.status).set(response.headers).send(response.data);

  } catch (err: any) {
    const status = err.response?.status || 500;
    const message = err.message || 'Unknown error';

    console.error(`[orchestrator] [proxy error] ${req.method} ${serviceUrl}${req.originalUrl} → ${status}: ${message}`);

    if (err.response?.data) {
      res.status(status).send(err.response.data);
    } else {
      res.status(status).json({ error: message });
    }
  }
}
