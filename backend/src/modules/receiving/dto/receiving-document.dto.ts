import { ReceivingStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/pagination';
import { trim, trimToNull } from '../../../common/transforms';

// Shapes mirror docs/openapi.yaml (schemas of the same name) and the GET /receiving-documents query.

export class UpdateReceivingItemRequest {
  // BR-05
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedQuantity!: number;
}

export class ReceivingItemInput extends UpdateReceivingItemRequest {
  @IsUUID()
  productId!: string;
}

export class CreateReceivingDocumentRequest {
  // BR-04
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  supplierName!: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string | null;

  // A calendar date only (OpenAPI format: date); strict rejects dates that do not exist, e.g. 2026-02-30.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expectedDate must be a date in the format YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  expectedDate?: string | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceivingItemInput)
  items: ReceivingItemInput[] = [];
}

// BR-07: a positive whole number; the upper bound is the largest line (BR-05).
export class RecordReceiptRequest {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

// BR-15, BR-17: the body of cancel, close short and receipt reversal.
export class ReasonRequest {
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ListReceivingDocumentsQuery extends PageQueryDto {
  @IsOptional()
  @IsEnum(ReceivingStatus)
  status?: ReceivingStatus;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export interface UserRef {
  id: string;
  fullName: string;
}

export interface ReceivingDocumentSummary {
  id: string;
  documentNumber: string;
  supplierName: string;
  referenceNumber: string | null;
  /** YYYY-MM-DD */
  expectedDate: string | null;
  status: ReceivingStatus;
  itemCount: number;
  totalExpectedQuantity: number;
  totalReceivedQuantity: number;
  createdAt: Date;
  createdBy: UserRef;
}

export interface ReceivingItem {
  id: string;
  product: { id: string; sku: string; name: string; unitOfMeasure: string };
  expectedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  isFullyReceived: boolean;
}

export interface ReceiptReversal {
  id: string;
  reason: string;
  reversedAt: Date;
  reversedBy: UserRef;
}

export interface Receipt {
  id: string;
  receivingItemId: string;
  productSku: string;
  quantity: number;
  receivedAt: Date;
  receivedBy: UserRef;
  reversal: ReceiptReversal | null;
}

export interface ReceiptResult {
  receipt: Receipt;
  item: ReceivingItem;
  document: { id: string; documentNumber: string; status: ReceivingStatus; allItemsReceived: boolean };
  inventory: { productId: string; quantityOnHand: number };
}

export interface ReceivingDocumentDetail extends ReceivingDocumentSummary {
  notes: string | null;
  allItemsReceived: boolean;
  items: ReceivingItem[];
  receipts: Receipt[];
  openedAt: Date | null;
  openedBy: UserRef | null;
  completedAt: Date | null;
  completedBy: UserRef | null;
  closedShortAt: Date | null;
  closedShortBy: UserRef | null;
  closeShortReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: UserRef | null;
  cancelReason: string | null;
  updatedAt: Date;
}
