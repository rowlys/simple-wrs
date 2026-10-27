import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { ReceivingDocumentsController } from './receiving-documents.controller';
import { ReceivingDocumentsService } from './receiving-documents.service';

@Module({ controllers: [ReceivingDocumentsController], providers: [ReceivingDocumentsService, ReceiptsService] })
export class ReceivingModule {}
