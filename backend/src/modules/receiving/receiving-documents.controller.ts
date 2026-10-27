import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AuthUser } from '../../common/auth/jwt-auth.guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { Page } from '../../common/pagination/pagination';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  ReasonRequest,
  ReceiptResult,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingItemInput,
  RecordReceiptRequest,
  UpdateReceivingItemRequest,
} from './dto/receiving-document.dto';
import { ReceiptsService } from './receipts.service';
import { ReceivingDocumentsService } from './receiving-documents.service';

const DocumentId = () => Param('documentId', ParseUUIDPipe);
const ItemId = () => Param('itemId', ParseUUIDPipe);

// BR-09, OpenAPI Idempotency-Key header.
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

@Controller('receiving-documents')
export class ReceivingDocumentsController {
  constructor(
    private readonly documents: ReceivingDocumentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get()
  list(@Query() query: ListReceivingDocumentsQuery): Promise<Page<ReceivingDocumentSummary>> {
    return this.documents.list(query);
  }

  @Post()
  @Roles('SUPERVISOR')
  create(@Body() body: CreateReceivingDocumentRequest, @CurrentUser() user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.documents.create(body, user);
  }

  @Get(':documentId')
  get(@DocumentId() documentId: string): Promise<ReceivingDocumentDetail> {
    return this.documents.get(documentId);
  }

  @Post(':documentId/items')
  @Roles('SUPERVISOR')
  addItem(@DocumentId() documentId: string, @Body() body: ReceivingItemInput): Promise<ReceivingDocumentDetail> {
    return this.documents.addItem(documentId, body);
  }

  @Patch(':documentId/items/:itemId')
  @Roles('SUPERVISOR')
  updateItem(
    @DocumentId() documentId: string,
    @ItemId() itemId: string,
    @Body() body: UpdateReceivingItemRequest,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.updateItem(documentId, itemId, body.expectedQuantity);
  }

  @Delete(':documentId/items/:itemId')
  @Roles('SUPERVISOR')
  @HttpCode(204)
  removeItem(@DocumentId() documentId: string, @ItemId() itemId: string): Promise<void> {
    return this.documents.removeItem(documentId, itemId);
  }

  @Post(':documentId/open')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  open(@DocumentId() documentId: string, @CurrentUser() user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.documents.open(documentId, user);
  }

  @Post(':documentId/complete')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  complete(@DocumentId() documentId: string, @CurrentUser() user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.documents.complete(documentId, user);
  }

  @Post(':documentId/close-short')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  closeShort(
    @DocumentId() documentId: string,
    @Body() body: ReasonRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ReceivingDocumentDetail> {
    return this.documents.closeShort(documentId, body.reason, user);
  }

  // FR-30, spec §6. 201 for a new receipt; 200 with Idempotent-Replayed: true for a replay (BR-09).
  @Post(':documentId/items/:itemId/receipts')
  @Roles('OPERATOR', 'SUPERVISOR')
  async recordReceipt(
    @DocumentId() documentId: string,
    @ItemId() itemId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RecordReceiptRequest,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReceiptResult> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Request validation failed.', {
        fields: [{ field: 'Idempotency-Key', message: 'Idempotency-Key must be 8–100 characters of A–Z, a–z, 0–9, _ or -' }],
      });
    }
    const { result, replayed } = await this.receipts.recordReceipt({ documentId, itemId, quantity: body.quantity, idempotencyKey }, user);
    if (replayed) res.status(200).setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  // FR-36, spec §6.2
  @Post(':documentId/receipts/:receiptId/reverse')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  reverseReceipt(
    @DocumentId() documentId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() body: ReasonRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ReceivingDocumentDetail> {
    return this.receipts.reverseReceipt(documentId, receiptId, body.reason, user);
  }

  @Post(':documentId/cancel')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  cancel(@DocumentId() documentId: string, @Body() body: ReasonRequest, @CurrentUser() user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.documents.cancel(documentId, body.reason, user);
  }
}
