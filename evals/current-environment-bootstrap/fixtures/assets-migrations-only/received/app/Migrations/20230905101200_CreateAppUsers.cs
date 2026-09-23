using Microsoft.EntityFrameworkCore.Migrations;

namespace Ship.Infrastructure.Migrations
{
    public partial class CreateAppUsers : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "APP_USERS",
                columns: table => new
                {
                    ID = table.Column<decimal>(type: "NUMBER(19)", nullable: false),
                    LOGIN_ID = table.Column<string>(type: "VARCHAR2(32)", nullable: false),
                    PASSWORD_HASH = table.Column<string>(type: "VARCHAR2(255)", nullable: false),
                    ROLE_CODE = table.Column<string>(type: "VARCHAR2(16)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_APP_USERS", x => x.ID);
                    table.UniqueConstraint("UQ_APP_USERS_LOGIN_ID", x => x.LOGIN_ID);
                });

            migrationBuilder.Sql("CREATE SEQUENCE SEQ_APP_USERS START WITH 1 INCREMENT BY 1");
        }
    }
}
