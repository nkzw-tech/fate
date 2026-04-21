/*
  Warnings:

  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectUpdate` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUpdate" DROP CONSTRAINT "ProjectUpdate_authorId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectUpdate" DROP CONSTRAINT "ProjectUpdate_projectId_fkey";

-- DropTable
DROP TABLE "Project";

-- DropTable
DROP TABLE "ProjectUpdate";

-- DropEnum
DROP TYPE "ProjectStatus";
