import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from './document.entity';

@Entity('chunks')
@Index(['document', 'chunkIndex'])
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Document, (doc) => doc.chunks, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Index()
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex!: number;

  @Column({ type: 'int', name: 'page_number' })
  pageNumber!: number;

  // pgvector column — stored as text in TypeORM metadata, formatted as
  // "[v1,v2,...]" by the embedding service. Postgres casts it to vector(1536)
  // via the column-type definition in the init SQL / migration.
  @Column({ type: 'text', nullable: true })
  embedding!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
