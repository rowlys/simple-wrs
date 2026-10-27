import { request } from './client';
import type { CreateProductRequest, Page, PageQuery, Product } from './types';

// One function per docs/openapi.yaml operation the UI uses (operationId in the comment).

export const listProducts = (query: PageQuery) => request<Page<Product>>('GET', '/products', { query: { ...query } }); // listProducts
export const createProduct = (body: CreateProductRequest) => request<Product>('POST', '/products', { body }); // createProduct
