import { JsonlTraceSink } from '@/modules/observability/interface/secondary/files/jsonl-sink';
import { loadPriceSnapshot } from '@/modules/observability/interface/secondary/files/price-snapshot';

export function createAuditInfrastructure() {
  return {
    sinkFactory: (file: string) => new JsonlTraceSink(file),
    priceSnapshotLoader: loadPriceSnapshot,
  };
}
