import type { PriceCalculation } from "@ai-door-assistant/shared";

export function Calculations(props: { calculation?: PriceCalculation }) {
  return (
    <section className="panel">
      <h2>Расчёты</h2>
      {!props.calculation ? (
        <p className="empty">Расчёт ещё не выполнялся</p>
      ) : (
        <div className="calculation">
          <div className="calc-row">
            <span>{props.calculation.door.label}</span>
            <span>{props.calculation.door.amount}</span>
          </div>
          {props.calculation.components.map((c, i) => (
            <div className="calc-row" key={i}>
              <span>{c.label}</span>
              <span>{c.amount}</span>
            </div>
          ))}
          {props.calculation.customSizeSurcharge && (
            <div className="calc-row">
              <span>{props.calculation.customSizeSurcharge.label}</span>
              <span>{props.calculation.customSizeSurcharge.amount}</span>
            </div>
          )}
          {props.calculation.services.map((s, i) => (
            <div className="calc-row" key={i}>
              <span>{s.label}</span>
              <span>{s.amount}</span>
            </div>
          ))}
          <div className="calc-row calc-total">
            <span>Итого</span>
            <span>
              {props.calculation.total} {props.calculation.currency}
            </span>
          </div>
          {props.calculation.missingInputs.length > 0 && (
            <ul className="calc-missing">
              {props.calculation.missingInputs.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
