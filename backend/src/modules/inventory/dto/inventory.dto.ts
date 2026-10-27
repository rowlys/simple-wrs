import { InventoryTransactionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';
import { trim } from '../../../common/transforms';
import { UserRef } from '../../receiving/dto/receiving-document.dto';

// Shapes mirror docs/openapi.yaml: InventoryBalance, InventoryTransaction and the GET /inventory* queries.

// D-25: an RFC 3339 date-time with an offset, so the server's time zone never decides what it means; at most
// milliseconds, the precision of a JS Date, so converting it never moves the bound.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const dateTimeMessage = { message: '$property must be a date-time with an offset, e.g. 2026-10-27T08:00:00Z' };

export class ListInventoryQuery extends PageQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListTransactionsQuery extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  receivingDocumentId?: string;

  /** Inclusive lower bound on createdAt. */
  @IsOptional()
  @Matches(DATE_TIME, dateTimeMessage)
  @IsISO8601({ strict: true })
  from?: string;

  /** Exclusive upper bound on createdAt. */
  @IsOptional()
  @Matches(DATE_TIME, dateTimeMessage)
  @IsISO8601({ strict: true })
  to?: string;
}

export interface InventoryBalance {
  productId: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  quantityOnHand: number;
  updatedAt: Date;
}

export interface InventoryTransaction {
  /** Ledger sequence number; a bigint, sent as a string. */
  id: string;
  type: InventoryTransactionType;
  product: { id: string; sku: string; name: string };
  quantityChange: number;
  balanceAfter: number;
  receiptId: string | null;
  receiptReversalId: string | null;
  receivingDocument: { id: string; documentNumber: string } | null;
  createdBy: UserRef;
  createdAt: Date;
}
