import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobController } from 'src/presentation/controllers/jobs.controller';
import { AuthModule } from 'src/modules/auth.module';
import { JobEventsService } from 'src/infrastructure/services/job-events.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'library-scan' }, { name: 'file-processing' }, { name: 'duplicate-scan' }),
    AuthModule,
  ],
  controllers: [JobController],
  providers: [JobEventsService],
})
export class JobsModule {}
