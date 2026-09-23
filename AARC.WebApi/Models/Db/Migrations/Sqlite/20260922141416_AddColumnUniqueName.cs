using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AARC.WebApi.Models.Db.Migrations.Sqlite
{
    /// <inheritdoc />
    public partial class AddColumnUniqueName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UniqueName",
                table: "UserFiles",
                type: "TEXT",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserFiles_UniqueName",
                table: "UserFiles",
                column: "UniqueName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_UserFiles_UniqueName",
                table: "UserFiles");

            migrationBuilder.DropColumn(
                name: "UniqueName",
                table: "UserFiles");
        }
    }
}
