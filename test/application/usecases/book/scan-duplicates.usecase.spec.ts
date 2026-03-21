import { Test, TestingModule } from '@nestjs/testing';
import { ScanDuplicatesUseCase } from 'src/application/usecases/book/scan-duplicates.usecase';
import { getQueueToken } from '@nestjs/bullmq';

describe('ScanDuplicatesUseCase', () => {
  let useCase: ScanDuplicatesUseCase;
  const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanDuplicatesUseCase,
        {
          provide: getQueueToken('duplicate-scan'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    useCase = module.get<ScanDuplicatesUseCase>(ScanDuplicatesUseCase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Enqueues a scan-duplicates job', async () => {
    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith('scan-duplicates', {});
  });

  test('Returns ok result', async () => {
    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
  });
});
