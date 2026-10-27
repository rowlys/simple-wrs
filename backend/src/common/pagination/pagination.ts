import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

// Query params of every list endpoint (spec §4.4, OpenAPI Page / PageSize). Extend it per list.
export class PageQueryDto {
  // Upper bound keeps skip = (page - 1) * pageSize inside Prisma's 64-bit range (D-15).
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

// For Prisma `contains` searches: Prisma passes the text to ILIKE unescaped (D-14), so escape
// PostgreSQL's LIKE escape character and wildcards to match them literally.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

// Runs the page query and the count together and builds the spec §4.4 response.
export async function paginate<T>(
  { page, pageSize }: PageQueryDto,
  findPage: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<Page<T>> {
  const [data, totalItems] = await Promise.all([findPage({ skip: (page - 1) * pageSize, take: pageSize }), count()]);
  return { data, meta: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
}
