import { Module } from '@nestjs/common';
import { HistoryController, IncidentsController } from './operations.controller';
@Module({
  controllers: [IncidentsController, HistoryController],
})
export class OperationsModule {}
