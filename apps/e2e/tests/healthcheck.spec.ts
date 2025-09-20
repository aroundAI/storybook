import { expect, test } from '@playwright/test';

// Simple healthcheck test to verify the API is up and the database responds

test.describe('Healthcheck endpoint', () => {
  test('returns healthy status', async ({ request }) => {
    const response = await request.get('/healthcheck');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        services: expect.objectContaining({ database: true }),
      }),
    );
  });
});
