import { Test, TestingModule } from '@nestjs/testing';
import { ScanDuplicatesUseCase } from 'src/application/usecases/book/scan-duplicates.usecase';
import { IDuplicateScanQueue } from 'src/application/interfaces/duplicate-scan-queue';

describe('ScanDuplicatesUseCase', () => {
  let useCase: ScanDuplicatesUseCase;
  const mockDuplicateScanQueue: IDuplicateScanQueue = { enqueueScan: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanDuplicatesUseCase,
        {
          provide: 'DuplicateScanQueue',
          useValue: mockDuplicateScanQueue,
        },
      ],
    }).compile();

    useCase = module.get<ScanDuplicatesUseCase>(ScanDuplicatesUseCase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Enqueues a duplicate scan job', async () => {
    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    expect(mockDuplicateScanQueue.enqueueScan).toHaveBeenCalledTimes(1);
  });

  test('Returns ok result', async () => {
    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
  });
});
