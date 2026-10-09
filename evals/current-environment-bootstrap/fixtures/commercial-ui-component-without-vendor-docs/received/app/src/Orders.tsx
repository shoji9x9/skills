import { Grid, GridColumn } from "@progress/kendo-react-grid";

type OrderRow = { orderNumber: string; status: string };

export function Orders({ rows }: { rows: OrderRow[] }) {
  return (
    <Grid data={rows} sortable filterable>
      <GridColumn field="orderNumber" title="Order number" />
      <GridColumn field="status" title="Status" />
    </Grid>
  );
}
