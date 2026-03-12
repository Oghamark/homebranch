import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobController } from 'src/presentation/controllers/jobs.controller';
import { AuthModule } from 'src/modules/auth.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'library-scan' }, { name: 'file-processing' }), AuthModule],
  controllers: [JobController],
})
export class JobsModule {}
