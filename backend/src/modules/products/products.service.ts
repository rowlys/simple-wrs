import { Injectable } from '@nestjs/common';
import { InventoryBalance, Prisma, Product as ProductRow } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { escapeLike, Page, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductRequest, ListProductsQuery, Product } from './dto/product.dto';

// Every product has a balance (FR-12), so a missing one is a bug and fails loudly as a 500.
const toProduct = ({ balance, ...p }: ProductRow & { balance: InventoryBalance | null }): Product => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  unitOfMeasure: p.unitOfMeasure,
  description: p.description,
  quantityOnHand: balance!.quantityOnHand,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ search, ...pageQuery }: ListProductsQuery): Promise<Page<Product>> {
    const text = search && escapeLike(search);
    const where: Prisma.ProductWhereInput = text
      ? {
          OR: [
            { sku: { contains: text, mode: 'insensitive' } },
            { name: { contains: text, mode: 'insensitive' } },
          ],
        }
      : {};
    const page = await paginate(
      pageQuery,
      (args) =>
        this.prisma.product.findMany({
          where,
          include: { balance: true },
          // id breaks created_at ties (rows created in one transaction), so paging never repeats or skips a row.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...args,
        }),
      () => this.prisma.product.count({ where }),
    );
    return { ...page, data: page.data.map(toProduct) };
  }

  async get(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { balance: true } });
    if (!product) throw new AppError(ErrorCode.NOT_FOUND, 'Product not found.');
    return toProduct(product);
  }

  // FR-12: product and its 0 balance in one nested write (one transaction). A duplicate SKU fails on the
  // unique constraint (P2002 → 409 DUPLICATE_SKU in the filter), which is also safe under concurrent creates.
  async create({ sku, name, unitOfMeasure, description }: CreateProductRequest): Promise<Product> {
    const product = await this.prisma.product.create({
      data: { sku, name, unitOfMeasure, description, balance: { create: { quantityOnHand: 0 } } },
      include: { balance: true },
    });
    return toProduct(product);
  }
}
