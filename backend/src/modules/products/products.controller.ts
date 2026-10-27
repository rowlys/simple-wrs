import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/decorators';
import { Page } from '../../common/pagination/pagination';
import { CreateProductRequest, ListProductsQuery, Product } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query() query: ListProductsQuery): Promise<Page<Product>> {
    return this.products.list(query);
  }

  @Get(':productId')
  get(@Param('productId', ParseUUIDPipe) productId: string): Promise<Product> {
    return this.products.get(productId);
  }

  @Post()
  @Roles('SUPERVISOR')
  create(@Body() body: CreateProductRequest): Promise<Product> {
    return this.products.create(body);
  }
}
