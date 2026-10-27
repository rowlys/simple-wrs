import { Controller, Get, Query } from '@nestjs/common';
import { Page } from '../../common/pagination/pagination';
import { InventoryBalance, InventoryTransaction, ListInventoryQuery, ListTransactionsQuery } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

// Any authenticated user (spec §8).
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query() query: ListInventoryQuery): Promise<Page<InventoryBalance>> {
    return this.inventory.list(query);
  }

  @Get('transactions')
  transactions(@Query() query: ListTransactionsQuery): Promise<Page<InventoryTransaction>> {
    return this.inventory.transactions(query);
  }
}
