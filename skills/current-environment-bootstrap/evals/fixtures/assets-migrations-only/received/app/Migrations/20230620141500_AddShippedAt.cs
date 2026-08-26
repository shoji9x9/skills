using Microsoft.EntityFrameworkCore.Migrations;

namespace Ship.Infrastructure.Migrations
{
    public partial class AddShippedAt : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SHIPPED_AT",
                table: "ORDERS",
                type: "DATE",
                nullable: true);
        }
    }
}
