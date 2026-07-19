import type { Product } from "@ai-door-assistant/shared";

export function FoundProducts(props: { products: Product[] }) {
  return (
    <section className="panel">
      <h2>Найденные товары</h2>
      {props.products.length === 0 ? (
        <p className="empty">Пока ничего не найдено</p>
      ) : (
        <ul className="product-list">
          {props.products.map((product) => (
            <li key={product.id}>
              <a href={product.url} target="_blank" rel="noreferrer">
                {product.name}
              </a>
              <span className="product-sku">{product.sku}</span>
              <span className="product-price">
                {product.price ? `${product.price} ${product.currency ?? "RUB"}` : "цена не указана"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
