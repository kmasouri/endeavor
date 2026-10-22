# Adding a Feature

This guide adds a made-up `orders` feature, step by step. At each step, copy the matching `items` file and rename it. `items` is the working example.

Start at the bottom layer and work up. That way each new file can use the ones you already made.

## 1. Table

Create `db/schema/002_orders.sql`. Use the Postgres schema name from `000_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS <schema>.orders (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES <schema>.items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## 2. Type

Add an `Order` type to `src/shared/types.ts`. Use camelCase names. The database uses snake_case, and the repository converts between them.

```ts
export interface Order {
  id: string;
  itemId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}
```

## 3. Repository

Create these files in `src/data/orders/`:

- `order.repository.ts`: the `OrderRepository` interface, which lists the methods the service can call, plus their input types.
- `order-postgres.repository.ts`: the `OrderPostgresRepository` class. It runs the SQL and turns each database row into an `Order`.
- `index.ts`: exports both.

Then add `export * from './orders';` to `src/data/index.ts`.

## 4. Errors

Add the feature's errors to `ERRORS` in `src/shared/errors.ts`. Give the feature its own range of codes, like `30xxx` for orders:

```ts
// 30xxx: orders
orderNotFound: { code: 30001, statusCode: 404, message: 'Order not found' },
```

Add each one to `docs/errors.md` too, with what it means and how to fix it. A test fails if you forget.

## 5. Logger

Create `src/observability/loggers/orders/order.logger.ts`, with one method per event. Copy `item.logger.ts`:

```ts
export class OrderLogger {
  constructor(private readonly logger: FastifyBaseLogger) {}

  onOrderCreated(): void {
    currentLogger(this.logger).info({ event: 'order.created' }, 'order created');
  }
}
```

Add `index.ts`, and export it from `src/observability/loggers/index.ts`.

## 6. Service

Create `src/services/orders/order.service.ts` with an `OrderService` class. This is where the business logic goes. It gets its repositories and logger in the constructor, and never sees the HTTP request.

When something goes wrong, it throws an error from the catalog. When something happens, it logs it:

```ts
async getOrder(orderId: string): Promise<Order> {
  const order = await this.orderRepository.getById(orderId);
  if (!order) {
    throw new AppError('orderNotFound', `Order ${orderId} was not found`);
  }

  this.orderLogger.onOrderFetched();
  return order;
}
```

If the service needs another feature's data, give it that feature's repository too. For example, to check that an item exists:

```ts
constructor(
  private readonly orderRepository: OrderRepository,
  private readonly itemRepository: ItemRepository,
  private readonly orderLogger: OrderLogger
) {}
```

Never import another service, like `ItemService`. Lint blocks it. Use the other feature's repository instead.

If the service calls an outside system, like an email provider or the OpenAI API, add an integration in `src/integrations/<feature>/` and pass it in the same way. See "Integrations" in `docs/architecture.md`.

Add `index.ts`, and export it from `src/services/index.ts`. Add `order.service.test.ts` with the repositories and logger mocked. See `item.service.test.ts`.

## 7. Plugin

Create `src/plugins/order.ts` by copying `src/plugins/item.ts`. It builds everything the service needs, then attaches only the service to Fastify:

```ts
const orderPlugin: FastifyPluginAsync = async (fastify) => {
  const orderService = new OrderService(
    new OrderPostgresRepository(fastify.pg),
    new ItemPostgresRepository(fastify.pg),
    new OrderLogger(fastify.log)
  );

  fastify.decorate('orderService', orderService);
};
```

Add `orderService` to `declare module 'fastify'`. Never attach a repository. Only services use repositories.

Register the plugin in `src/app.ts`, next to `itemPlugin`.

## 8. Schemas

Create `src/schemas/orders/orders.schemas.ts`:

```ts
export const orderParamsSchema = z.object({ orderId: z.uuid() });

export const createOrderBodySchema = z.strictObject({
  itemId: z.uuid(),
  quantity: z.number().int().min(1)
});

export type OrderParams = z.infer<typeof orderParamsSchema>;
export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
```

Numbers in the query string or URL arrive as strings. Use `z.coerce.number()` for those.

Add `index.ts`, and export it from `src/schemas/index.ts`.

## 9. Handlers

Create `src/handlers/orders/orders.ts`. A handler reads the request, calls the service, and sends the response. Nothing else:

```ts
export async function createOrderHandler(
  request: FastifyRequest<{ Body: CreateOrderBody }>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const order = await request.server.orderService.createOrder(request.body);
  return reply.code(201).send(success(order));
}
```

For lists, use `paged(items, { limit, offset, total })` instead of `success`.

Add `index.ts`, and export it from `src/handlers/index.ts`.

## 10. Router

Create `src/routes/orders/orders.ts`, exporting `ordersRouter`. Give every route a `description` and `tags: ['orders']`, so it shows up nicely in Swagger.

Add `index.ts`, export it from `src/routes/index.ts`, and register it in `src/app.ts`:

```ts
app.register(routes.ordersRouter);
```

## 11. Tests and docs

- Add bad-input cases to `src/app.test.ts`. Send bad params and bodies with `app.inject`, and expect a 400 `validationError`.
- Add the new endpoints to the API list in `README.md`.
- Run `npm run check`.
