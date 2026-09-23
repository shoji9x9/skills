import { Grid, GridColumn } from "@progress/kendo-react-grid";

export function Orders({ rows }) {
  return (
    <Grid data={rows} sortable filterable>
      <GridColumn field="orderNumber" title="Order number" />
      <GridColumn field="status" title="Status" />
    </Grid>
  );
}
