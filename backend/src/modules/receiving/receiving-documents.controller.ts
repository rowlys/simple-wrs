import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AuthUser } from '../../common/auth/jwt-auth.guard';
import { Page } from '../../common/pagination/pagination';
import {
  CreateReceivingDocumentRequest,
  ListReceivingDocumentsQuery,
  ReasonRequest,
  ReceivingDocumentDetail,
  ReceivingDocumentSummary,
  ReceivingItemInput,
  UpdateReceivingItemRequest,
} from './dto/receiving-document.dto';
import { ReceivingDocumentsService } from './receiving-documents.service';

const DocumentId = () => Param('documentId', ParseUUIDPipe);
const ItemId = () => Param('itemId', ParseUUIDPipe);

@Controller('receiving-documents')
export class ReceivingDocumentsController {
  constructor(private readonly documents: ReceivingDocumentsService) {}

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

  @Post(':documentId/cancel')
  @Roles('SUPERVISOR')
  @HttpCode(200)
  cancel(@DocumentId() documentId: string, @Body() body: ReasonRequest, @CurrentUser() user: AuthUser): Promise<ReceivingDocumentDetail> {
    return this.documents.cancel(documentId, body.reason, user);
  }
}
