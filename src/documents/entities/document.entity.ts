import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Chunk } from './chunk.entity';
import { Question } from '../../questions/entities/question.entity';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ type: 'varchar', length: 512, name: 'original_name' })
  originalName!: string;

  @Column({ type: 'int', name: 'page_count' })
  pageCount!: number;

  @Column({ type: 'int', name: 'chunk_count' })
  chunkCount!: number;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Chunk, (chunk) => chunk.document, { cascade: true })
  chunks!: Chunk[];

  @OneToMany(() => Question, (question) => question.document, { cascade: true })
  questions!: Question[];
}
