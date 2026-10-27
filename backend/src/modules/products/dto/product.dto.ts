import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';
import { trim, trimToNull } from '../../../common/transforms';

// Shapes mirror docs/openapi.yaml: CreateProductRequest, Product, and the GET /products query.

export class CreateProductRequest {
  // BR-01: normalized before validation, so `  frz-1  ` is valid and `abc-1` collides with `ABC-1` (BR-02).
  // ASCII letters only: full Unicode upper-casing would turn `ß`/`ſ`/`ı` into A–Z letters the user never typed.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/[a-z]+/g, (s) => s.toUpperCase()) : value))
  @IsString()
  @Length(3, 50)
  @Matches(/^[A-Z0-9][A-Z0-9-]*$/, { message: 'sku may contain only letters, digits and hyphens, and may not start with a hyphen' })
  sku!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 20)
  unitOfMeasure!: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

export class ListProductsQuery extends PageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  description: string | null;
  quantityOnHand: number;
  createdAt: Date;
  updatedAt: Date;
}
