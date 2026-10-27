import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';

const api = (app: INestApplication, token: string) => ({
  post: (path: string) => request(app.getHttpServer()).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
});

// Products with a 0 balance, in SKU order.
export async function createProducts(prisma: PrismaService, skus: string[]) {
  const products = [];
  for (const sku of skus) {
    products.push(
      await prisma.product.create({
        data: { sku, name: `Product ${sku}`, unitOfMeasure: 'CTN', balance: { create: { quantityOnHand: 0 } } },
      }),
    );
  }
  return products;
}

// A document created and opened through the API by the supervisor; returns its detail (lines in SKU order).
export async function openDocument(app: INestApplication, supervisorToken: string, lines: { productId: string; expectedQuantity: number }[]) {
  const created = await api(app, supervisorToken).post('/receiving-documents').send({ supplierName: 'PT Sumber Beku', items: lines });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
  const opened = await api(app, supervisorToken).post(`/receiving-documents/${created.body.id}/open`);
  if (opened.status !== 200) throw new Error(`open failed: ${opened.status} ${JSON.stringify(opened.body)}`);
  return opened.body;
}

export const receive = (
  app: INestApplication,
  token: string,
  documentId: string,
  itemId: string,
  quantity: unknown,
  key: string | null = randomUUID(), // null sends no header
) => {
  const req = api(app, token).post(`/receiving-documents/${documentId}/items/${itemId}/receipts`);
  return (key === null ? req : req.set('Idempotency-Key', key)).send({ quantity });
};

export const reverse = (app: INestApplication, token: string, documentId: string, receiptId: string, body: object = { reason: 'Typo, counted 10' }) =>
  api(app, token).post(`/receiving-documents/${documentId}/receipts/${receiptId}/reverse`).send(body);
