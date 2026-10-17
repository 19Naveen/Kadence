import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path
import uuid

class ParquetWriter:
    @staticmethod
    def write_chunk(columns, rows, output_dir):
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        data = [dict(zip(columns, row)) for row in rows]
        table = pa.Table.from_pylist(data)
        file_name = f"{uuid.uuid4()}.parquet"
        file_path = f"{output_dir}/{file_name}"
        pq.write_table(table, file_path)
        return file_path
        