using Microsoft.EntityFrameworkCore.Migrations;

namespace Ship.Infrastructure.Migrations
{
    public partial class CreateCoreTables : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CUSTOMERS",
                columns: table => new
                {
                    ID = table.Column<decimal>(type: "NUMBER(19)", nullable: false),
                    CODE = table.Column<string>(type: "VARCHAR2(16)", nullable: false),
                    NAME = table.Column<string>(type: "VARCHAR2(120)", nullable: false),
                    CREATED_AT = table.Column<DateTime>(type: "DATE", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CUSTOMERS", x => x.ID);
                    table.UniqueConstraint("UQ_CUSTOMERS_CODE", x => x.CODE);
                });

            migrationBuilder.CreateTable(
                name: "ORDERS",
                columns: table => new
                {
                    ID = table.Column<decimal>(type: "NUMBER(19)", nullable: false),
                    ORDER_NO = table.Column<string>(type: "VARCHAR2(20)", nullable: false),
                    CUSTOMER_ID = table.Column<decimal>(type: "NUMBER(19)", nullable: false),
                    STATUS = table.Column<decimal>(type: "NUMBER(2)", nullable: false, defaultValue: 0m),
                    ORDERED_AT = table.Column<DateTime>(type: "DATE", nullable: false),
                    TOTAL_AMOUNT = table.Column<decimal>(type: "NUMBER(12)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ORDERS", x => x.ID);
                    table.UniqueConstraint("UQ_ORDERS_ORDER_NO", x => x.ORDER_NO);
                    table.ForeignKey("FK_ORDERS_CUSTOMER", x => x.CUSTOMER_ID, "CUSTOMERS", "ID");
                });

            migrationBuilder.Sql("CREATE SEQUENCE SEQ_CUSTOMERS START WITH 1 INCREMENT BY 1");
            migrationBuilder.Sql("CREATE SEQUENCE SEQ_ORDERS START WITH 10000 INCREMENT BY 1");
        }
    }
}
