export interface PaginationLike {
  page?: number;
  pageSize?: number;
  totalCount?: number;
  totalPages?: number;
  skip?: number;
  take?: number;
}

/**
 * Format pagination copied off CompassOne's `meta` object.
 * Page metadata (`currentPage` / `totalPages`) wins when the SDK mapped it
 * onto `page`. Skip/take metadata is used for alert groups.
 */
export function formatPagination(pagination: PaginationLike | null | undefined): string {
  if (!pagination) return '';

  const hasSkip = pagination.skip !== undefined || pagination.take !== undefined;
  if (pagination.page === undefined && hasSkip) {
    const take = pagination.take ?? pagination.pageSize;
    const total = pagination.totalCount !== undefined ? ` of ${pagination.totalCount}` : '';
    const takeText = take !== undefined ? `, take ${take}` : '';
    return `(skip ${pagination.skip ?? 0}${takeText}${total})`;
  }

  if (pagination.page !== undefined) {
    const pages =
      pagination.totalPages !== undefined
        ? pagination.totalPages
        : Math.ceil((pagination.totalCount || 0) / (pagination.pageSize || 50));
    return `(Page ${pagination.page} of ${pages})`;
  }

  return '';
}

export function pageItems<T>(response: T[] | { data?: T[]; pagination?: PaginationLike | null } | null | undefined): {
  items: T[];
  pagination: PaginationLike | null;
} {
  if (Array.isArray(response)) {
    return { items: response, pagination: null };
  }
  return {
    items: response?.data ?? [],
    pagination: response?.pagination ?? null,
  };
}
