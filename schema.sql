-- Ejecutar una sola vez en db_WebDevUMG. No modifica tablas del reto anterior.
IF OBJECT_ID('dbo.Copart_Javier_Usuarios','U') IS NULL
CREATE TABLE dbo.Copart_Javier_Usuarios (
  Id INT IDENTITY PRIMARY KEY,
  Nombre NVARCHAR(100) NOT NULL,
  Apellido NVARCHAR(100) NOT NULL,
  Correo NVARCHAR(180) NOT NULL UNIQUE,
  Telefono NVARCHAR(30) NOT NULL,
  ClaveHash NVARCHAR(255) NOT NULL,
  Creado DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('dbo.Copart_Javier_Vehiculos','U') IS NULL
CREATE TABLE dbo.Copart_Javier_Vehiculos (
  Id INT IDENTITY PRIMARY KEY,
  VendedorId INT NOT NULL REFERENCES dbo.Copart_Javier_Usuarios(Id),
  Anio INT NOT NULL,
  Tipo NVARCHAR(70) NOT NULL,
  Marca NVARCHAR(80) NOT NULL,
  Modelo NVARCHAR(80) NOT NULL,
  Motor NVARCHAR(80) NOT NULL,
  Transmision NVARCHAR(80) NOT NULL,
  Combustible NVARCHAR(60) NOT NULL,
  Traccion NVARCHAR(20) NOT NULL,
  Cilindros INT NOT NULL,
  Danio NVARCHAR(20) NOT NULL,
  PrecioBase DECIMAL(18,2) NOT NULL,
  Inicio DATETIME2 NOT NULL,
  Fin DATETIME2 NOT NULL,
  Creado DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Copart_Javier_Fechas CHECK(Fin > Inicio),
  CONSTRAINT CK_Copart_Javier_Precio CHECK(PrecioBase > 0),
  CONSTRAINT CK_Copart_Javier_Danio CHECK(Danio IN (N'Verde',N'Amarillo',N'Rojo'))
);
IF OBJECT_ID('dbo.Copart_Javier_Fotos','U') IS NULL
CREATE TABLE dbo.Copart_Javier_Fotos (
  Id INT IDENTITY PRIMARY KEY,
  VehiculoId INT NOT NULL REFERENCES dbo.Copart_Javier_Vehiculos(Id) ON DELETE CASCADE,
  Url NVARCHAR(1000) NOT NULL,
  Orden INT NOT NULL
);
IF OBJECT_ID('dbo.Copart_Javier_Pujas','U') IS NULL
CREATE TABLE dbo.Copart_Javier_Pujas (
  Id INT IDENTITY PRIMARY KEY,
  VehiculoId INT NOT NULL REFERENCES dbo.Copart_Javier_Vehiculos(Id),
  UsuarioId INT NOT NULL REFERENCES dbo.Copart_Javier_Usuarios(Id),
  Monto DECIMAL(18,2) NOT NULL,
  Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Copart_Javier_Monto CHECK(Monto > 0)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Copart_Javier_Pujas_Vehiculo' AND object_id = OBJECT_ID('dbo.Copart_Javier_Pujas'))
CREATE INDEX IX_Copart_Javier_Pujas_Vehiculo ON dbo.Copart_Javier_Pujas(VehiculoId, Monto DESC);
